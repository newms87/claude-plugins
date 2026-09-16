// Shared shell-command parsing for the base plugin's PreToolUse guards.
//
// Guards need to see every command a Bash or PowerShell tool call will really
// run — including the ones hidden inside `bash -c`, `wsl.exe`, `docker exec`,
// `powershell -Command`, `cmd /c`, `sudo`, `env`, `xargs` and `$( ... )` —
// without mistaking heredoc bodies, comments or quoted arguments for commands.
// `simpleCommands()` is that single view; each guard decides what to block.

// ---------------------------------------------------------------------------
// Tokenizers. Each returns a list of simple commands: arrays of words, where a
// word is { text, dynamic } — `dynamic` marks text the shell will expand at run
// time (variables, command substitution, globs, a leading ~). Command
// substitutions are also returned as nested scripts so their contents are
// checked. Neither tokenizer throws: malformed input degrades to best-effort
// words, and an unterminated quote simply runs to the end of the input.
// ---------------------------------------------------------------------------

const POSIX_OPERATORS = [";;", "&&", "||", ";", "&", "|", "(", ")", "\n"];

/** Tokenize POSIX shell source into simple commands. */
export function tokenizePosix(src) {
  const commands = [];
  const substitutions = [];
  let words = [];
  let word = null;
  const pendingHeredocs = [];

  const startWord = () => {
    if (!word) word = { text: "", dynamic: false };
  };
  const endWord = () => {
    if (word) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };

  /** Read `$( ... )` / backtick body starting at i (after the opener). */
  const readBalanced = (i, open, close) => {
    let depth = 1;
    let j = i;
    let quote = null;
    while (j < src.length) {
      const c = src[j];
      if (quote) {
        if (c === "\\" && quote === '"') j++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"') quote = c;
      else if (c === "\\") j++;
      else if (open && src.startsWith(open, j)) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return { body: src.slice(i, j), end: j + 1 };
      }
      j++;
    }
    return { body: src.slice(i), end: src.length };
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    // Heredoc bodies are data, not commands: skip them once their line ends.
    if (c === "\n" && pendingHeredocs.length) {
      endCommand();
      i++;
      while (pendingHeredocs.length) {
        const { delim, stripTabs } = pendingHeredocs.shift();
        while (i < src.length) {
          const nl = src.indexOf("\n", i);
          const line = src.slice(i, nl === -1 ? src.length : nl);
          i = nl === -1 ? src.length : nl + 1;
          if ((stripTabs ? line.replace(/^\t+/, "") : line) === delim) break;
        }
      }
      continue;
    }

    if (c === "#" && !word) {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }

    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
      continue;
    }

    if (c === "<" && src.startsWith("<<", i) && !src.startsWith("<<<", i)) {
      endWord();
      let j = i + 2;
      const stripTabs = src[j] === "-";
      if (stripTabs) j++;
      while (src[j] === " " || src[j] === "\t") j++;
      let delim = "";
      while (j < src.length && !/[\s;&|<>()]/.test(src[j])) {
        if (src[j] !== "'" && src[j] !== '"' && src[j] !== "\\") delim += src[j];
        j++;
      }
      if (delim) pendingHeredocs.push({ delim, stripTabs });
      i = j;
      continue;
    }

    const op = POSIX_OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      endCommand();
      i += op.length;
      continue;
    }

    if (c === "'") {
      startWord();
      const end = src.indexOf("'", i + 1);
      word.text += src.slice(i + 1, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    if (c === '"') {
      startWord();
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        // Inside double quotes a backslash only escapes $ ` " \ and newline;
        // before anything else it is literal — `"C:\Users\x"` keeps its backslashes.
        if (src[j] === "\\" && j + 1 < src.length && /[$`"\\\n]/.test(src[j + 1])) {
          if (src[j + 1] !== "\n") word.text += src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === "$" || src[j] === "`") {
          const consumed = readExpansion(j);
          j = consumed;
          continue;
        }
        word.text += src[j];
        j++;
      }
      i = j + 1;
      continue;
    }

    if (c === "\\") {
      startWord();
      if (src[i + 1] !== "\n") word.text += src[i + 1] ?? "";
      i += 2;
      continue;
    }

    if (c === "$" || c === "`") {
      i = readExpansion(i);
      continue;
    }

    startWord();
    if ((c === "~" && word.text === "") || c === "*" || c === "?" || c === "[") word.dynamic = true;
    word.text += c;
    i++;
  }
  endCommand();
  return { commands, substitutions };

  /** Consume a `$...` or backtick expansion at j into the current word; return new index. */
  function readExpansion(j) {
    startWord();
    word.dynamic = true;
    if (src[j] === "`") {
      const { body, end } = readBalanced(j + 1, null, "`");
      substitutions.push(body);
      word.text += src.slice(j, end);
      return end;
    }
    if (src.startsWith("$((", j)) {
      const { end } = readBalanced(j + 3, "(", ")");
      word.text += src.slice(j, Math.min(end + 1, src.length));
      return Math.min(end + 1, src.length);
    }
    if (src.startsWith("$(", j)) {
      const { body, end } = readBalanced(j + 2, "(", ")");
      substitutions.push(body);
      word.text += src.slice(j, end);
      return end;
    }
    if (src.startsWith("${", j)) {
      const close = src.indexOf("}", j + 2);
      const end = close === -1 ? src.length : close + 1;
      word.text += src.slice(j, end);
      return end;
    }
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])?/.exec(src.slice(j));
    word.text += m[0];
    return j + m[0].length;
  }
}

/** Tokenize PowerShell source into simple commands. */
export function tokenizePowerShell(src) {
  const commands = [];
  const substitutions = [];
  let words = [];
  let word = null;
  const startWord = () => {
    if (!word) word = { text: "", dynamic: false };
  };
  const endWord = () => {
    if (word) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "#" && !word) {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
      continue;
    }
    if (src.startsWith("&&", i) || src.startsWith("||", i)) {
      endCommand();
      i += 2;
      continue;
    }
    if (c === ";" || c === "|" || c === "\n" || c === "{" || c === "}" || c === "(" || c === ")") {
      endCommand();
      i++;
      continue;
    }
    if (c === "'") {
      startWord();
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "'" && src[j + 1] === "'") {
          word.text += "'";
          j += 2;
          continue;
        }
        if (src[j] === "'") break;
        word.text += src[j];
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === '"') {
      startWord();
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "`" && j + 1 < src.length) {
          word.text += src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === "$") word.dynamic = true;
        word.text += src[j];
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "`") {
      startWord();
      word.text += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      startWord();
      word.dynamic = true;
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth) {
        if (src[j] === "(") depth++;
        else if (src[j] === ")") depth--;
        j++;
      }
      substitutions.push(src.slice(i + 2, depth ? j : j - 1));
      word.text += src.slice(i, j);
      i = j;
      continue;
    }
    startWord();
    if (c === "$" || c === "*" || c === "?" || c === "%" || (c === "~" && word.text === "")) word.dynamic = true;
    word.text += c;
    i++;
  }
  endCommand();
  return { commands, substitutions };
}

// ---------------------------------------------------------------------------
// Walker.
// ---------------------------------------------------------------------------

/** Lower-cased executable name of a word: `C:\\Windows\\wsl.exe` -> `wsl`. */
export const commandName = (word) => word.text.replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.exe$/, "");

const PREFIX_WRAPPERS = new Set(["sudo", "doas", "nohup", "time", "command", "exec", "builtin", "nice", "ionice", "stdbuf", "setsid", "unbuffer"]);
const POSIX_SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const MAX_NESTING = 8;

/**
 * Every simple command a Bash/PowerShell tool call will run, at every nesting
 * level. Each entry is `{ lang, argv, stdinTargets }`:
 *   - `lang` is "posix" or "powershell" — how `argv` was parsed;
 *   - `argv` is the word list with leading VAR=value assignments removed;
 *   - `stdinTargets` is true when the command's operands are appended at run
 *     time from stdin (the command behind `xargs`), so they cannot be inspected.
 * Wrappers are reported themselves AND unwrapped, so a guard can match either
 * the wrapper (e.g. `wsl`) or what it runs.
 */
export function simpleCommands(command, toolName = "Bash") {
  const out = [];
  const queue = [{ lang: toolName === "PowerShell" ? "powershell" : "posix", src: command, depth: 0 }];
  while (queue.length) {
    const { lang, src, depth } = queue.shift();
    if (depth > MAX_NESTING) continue;
    const { commands, substitutions } = lang === "powershell" ? tokenizePowerShell(src) : tokenizePosix(src);
    for (const sub of substitutions) queue.push({ lang, src: sub, depth: depth + 1 });
    for (const argv of commands) {
      unwrap(argv, lang, false, (nestedLang, nestedSrc) => queue.push({ lang: nestedLang, src: nestedSrc, depth: depth + 1 }));
    }
  }
  return out;

  function unwrap(words, lang, stdinTargets, enqueue) {
    let argv = words;
    while (lang === "posix" && argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0].text)) argv = argv.slice(1);
    // PowerShell call operators: `& 'C:\x\tool.exe' args` / `. script.ps1`.
    if (lang === "powershell" && argv.length > 1 && (argv[0].text === "&" || argv[0].text === ".")) argv = argv.slice(1);
    if (!argv.length) return;
    out.push({ lang, argv, stdinTargets });

    const name = commandName(argv[0]);
    const rest = argv.slice(1);
    const skipOptions = (takesValue) => {
      let k = 0;
      while (k < rest.length && rest[k].text.startsWith("-")) k += takesValue(rest[k].text) ? 2 : 1;
      return k;
    };

    if (PREFIX_WRAPPERS.has(name)) {
      const k = skipOptions((t) => (name === "sudo" && /^-[ugCDhpRrTU]$/.test(t)) || (name === "nice" && t === "-n"));
      return unwrap(rest.slice(k), lang, stdinTargets, enqueue);
    }
    if (name === "env") {
      let k = 0;
      while (k < rest.length && (rest[k].text.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[k].text))) k += /^-(u|C|S)$/.test(rest[k].text) ? 2 : 1;
      return unwrap(rest.slice(k), lang, stdinTargets, enqueue);
    }
    if (name === "timeout") {
      const k = skipOptions((t) => /^-(s|k)$/.test(t));
      return unwrap(rest.slice(k + 1), lang, stdinTargets, enqueue);
    }
    if (name === "xargs") {
      const k = skipOptions((t) => /^-(I|L|n|P|s|d|E|a)$/.test(t));
      return unwrap(rest.slice(k), lang, true, enqueue);
    }
    if (POSIX_SHELLS.has(name)) {
      for (let k = 0; k < rest.length && rest[k].text.startsWith("-"); k++) {
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(rest[k].text) && k + 1 < rest.length) {
          enqueue("posix", rest[k + 1].text);
          break;
        }
      }
      return;
    }
    if (name === "wsl") {
      let k = 0;
      let execMode = false;
      while (k < rest.length) {
        const t = rest[k].text;
        if (t === "--") {
          k++;
          break;
        }
        if (t === "-e" || t === "--exec") {
          execMode = true;
          k++;
          break;
        }
        if (/^(-d|--distribution|-u|--user|--cd|--shell-type|--distribution-id)$/.test(t)) k += 2;
        else if (t.startsWith("-")) k++;
        else break;
      }
      const inner = rest.slice(k);
      if (!inner.length) return;
      // With -e the argv is exec'd directly; otherwise it is joined into a
      // command line that the distro's default shell re-parses.
      if (execMode) return unwrap(inner, "posix", stdinTargets, enqueue);
      return enqueue("posix", inner.map((w) => shellQuote(w.text)).join(" "));
    }
    if (name === "docker" || name === "podman") {
      if (rest[0]?.text !== "exec") return;
      let k = 1;
      while (k < rest.length && rest[k].text.startsWith("-")) k += /^(-u|--user|-w|--workdir|-e|--env|--env-file|--detach-keys)$/.test(rest[k].text) ? 2 : 1;
      return unwrap(rest.slice(k + 1), "posix", stdinTargets, enqueue);
    }
    if (name === "powershell" || name === "pwsh") {
      const k = rest.findIndex((w) => /^-(c|command)$/i.test(w.text));
      if (k !== -1) enqueue("powershell", rest.slice(k + 1).map((w) => w.text).join(" "));
      return;
    }
    if (name === "cmd") {
      const k = rest.findIndex((w) => /^\/[ck]$/i.test(w.text));
      if (k !== -1) enqueue("powershell", rest.slice(k + 1).map((w) => w.text).join(" "));
    }
  }
}

function shellQuote(s) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
