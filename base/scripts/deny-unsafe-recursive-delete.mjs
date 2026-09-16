#!/usr/bin/env node
// PreToolUse Bash|PowerShell deny hook — recursive deletes and mirror-syncs
// whose target is not a literal, specific path.
//
// Background: on 2026-09-15 at 23:29:39Z a danxbot builder agent (card
// DX-2869) ran a background "WSL rsync scratch-copy for Linux verification"
// meant to land in ~/dx2869. The destination reached rsync as `/`. `rsync
// --delete` makes the destination an exact mirror of the source, so for
// thirteen minutes it deleted everything under the WSL root the user could
// write: gpt-manager, danx and danxbot's repos in WSL, and — through /mnt/c —
// every Windows Claude Code transcript and several Windows project trees
// (mutagen then synced the WSL-side deletions into the Windows mirrors). Its
// own output read `rsync: [generator] delete_file: unlink(mnt/c/Users/...)
// failed: Permission denied`; a sandbox run of `rsync -a --delete src/ <root>/`
// reproduced that output line for line. The exact command text is unknown
// because the rsync deleted the transcript that held it — the likeliest shape
// is a destination built from a variable that expanded empty (`$DEST/` -> `/`).
//
// Rule: a command that deletes recursively (rm -r, find -delete, rsync
// --delete*, Remove-Item -Recurse, rd /s, robocopy /MIR|/PURGE) must name its
// target as a LITERAL path, and that path must not be a filesystem/drive/mount
// root, a home directory, or an ancestor of one. A variable is only accepted
// in the fail-loud `${NAME:?}` form followed by a literal path segment, because
// bash aborts on that expansion when NAME is empty instead of collapsing to `/`.
//
// Commands wrapped in `bash -c`, `wsl.exe [--] ...`, `docker exec`,
// `powershell -Command`, `cmd /c`, `sudo`, `env`, `xargs` and `$( ... )` are
// unwrapped and checked too — the incident command was itself a wsl.exe wrapper.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
        if (src[j] === "\\" && j + 1 < src.length) {
          word.text += src[j + 1];
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
// Target safety.
// ---------------------------------------------------------------------------

/**
 * Decide whether one delete/mirror target word is acceptable.
 * Returns null when safe, or a short human reason when not.
 */
export function unsafeTargetReason(word) {
  let text = word.text;
  if (word.dynamic) {
    // The one accepted dynamic form: `${NAME:?...}` (or `${NAME?...}`) followed
    // by a literal path segment. bash aborts on an empty/unset NAME instead of
    // collapsing the path, and the trailing segment keeps it off a bare root.
    const guarded = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?\?[^}]*\}\/+([^/$`*?[~][^$`*?[]*)$/.exec(text);
    if (!guarded || /^\.{1,2}$/.test(guarded[1].split("/")[0])) {
      return "it is built from a variable, command substitution, glob or ~ that is only resolved at run time — an empty or unexpected value turns it into `/` or a home directory";
    }
    return null;
  }
  if (text.trim() === "") return "it is empty, which some tools resolve to the current directory or root";

  const p = text.replace(/\\/g, "/");
  if (/(^|\/)\.\.(\/|$)/.test(p)) return "it climbs with `..`, so the real target depends on the working directory";
  if (/^\.\/*$/.test(p)) return "it is the current directory itself, whose location is not visible in the command";

  const protectedReason = protectedPathReason(p);
  return protectedReason;
}

/** Protected: filesystem/drive/mount roots, home directories, and their ancestors. */
function protectedPathReason(path) {
  let p = path;
  // UNC access into a WSL distro: //wsl$/Ubuntu/home/x -> /home/x
  const unc = /^\/\/(wsl\$|wsl\.localhost)\/[^/]+(\/.*)?$/i.exec(p);
  if (unc) p = unc[2] ?? "/";
  else if (/^\/\/[^/]+(\/[^/]+)?\/*$/.test(p)) return "it is a network share root";

  let drive = null;
  let rest = null;
  let m;
  if ((m = /^([A-Za-z]):(\/.*)?$/.exec(p))) {
    drive = m[1];
    rest = m[2] ?? "/";
  } else if ((m = /^\/mnt\/([A-Za-z])(\/.*)?$/.exec(p))) {
    drive = m[1];
    rest = m[2] ?? "/";
  } else if ((m = /^\/([A-Za-z])(\/.*)?$/.exec(p))) {
    drive = m[1];
    rest = m[2] ?? "/";
  }

  if (!p.startsWith("/") && drive === null) return null; // relative path with a real segment

  const segs = (drive === null ? p : rest).split("/").filter(Boolean);
  const where = drive === null ? "" : ` on drive ${drive.toUpperCase()}:`;

  if (segs.length === 0) return drive === null ? "it is the filesystem root `/`" : `it is the root of drive ${drive.toUpperCase()}:`;

  if (drive !== null) {
    if (segs.length === 1) return `it is a top-level folder${where}`;
    if (segs[0].toLowerCase() === "users" && segs.length === 2) return `it is a Windows home directory${where}`;
    return null;
  }

  const top = segs[0];
  if (segs.length === 1) return `it is the top-level system directory \`/${top}\``;
  if (top === "mnt" || top === "media" || top === "Volumes") {
    return segs.length === 2 ? "it is a mount root" : null;
  }
  if ((top === "home" || top === "Users") && segs.length === 2) return "it is a home directory";
  if (top === "tmp") return null;
  if (segs.length === 2) return `it is a system directory (\`/${segs.join("/")}\`)`;
  return null;
}

// ---------------------------------------------------------------------------
// Command analysis.
// ---------------------------------------------------------------------------

const base = (w) => w.text.replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.exe$/, "");

const RSYNC_ARG_OPTIONS = new Set([
  "-e", "-f", "-T", "-B", "-M", "--rsh", "--rsync-path", "--exclude", "--include", "--exclude-from",
  "--include-from", "--filter", "--files-from", "--temp-dir", "--partial-dir", "--link-dest", "--copy-dest",
  "--compare-dest", "--backup-dir", "--suffix", "--chmod", "--chown", "--usermap", "--groupmap", "--timeout",
  "--contimeout", "--port", "--password-file", "--log-file", "--log-file-format", "--out-format", "--bwlimit",
  "--max-size", "--min-size", "--max-delete", "--modify-window", "--iconv", "--checksum-choice",
  "--compress-choice", "--compress-level", "--skip-compress", "--block-size", "--info", "--debug", "--outbuf",
  "--sockopts", "--write-batch", "--only-write-batch", "--read-batch", "--protocol", "--address",
  "--remote-option", "--stop-after", "--stop-at",
]);

/**
 * Analyse one simple command. Returns a list of findings
 * ({ tool, target, reason }) and a list of nested scripts ({ lang, src }) to
 * analyse recursively.
 */
function analyseCommand(argv, lang) {
  const findings = [];
  const nested = [];
  let args = argv;

  // Leading environment assignments (POSIX).
  while (lang === "posix" && args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0].text)) args = args.slice(1);
  if (!args.length) return { findings, nested };

  const name = base(args[0]);
  const rest = args.slice(1);

  // Transparent wrappers: analyse the wrapped argv as a command.
  if (["sudo", "doas", "nohup", "time", "command", "exec", "builtin", "nice", "ionice", "stdbuf", "setsid", "unbuffer"].includes(name)) {
    let k = 0;
    while (k < rest.length && rest[k].text.startsWith("-")) {
      if (name === "sudo" && /^-[ugCDhpRrTU]$/.test(rest[k].text)) k++;
      if (name === "nice" && rest[k].text === "-n") k++;
      k++;
    }
    return merge(analyseCommand(rest.slice(k), lang));
  }
  if (name === "env") {
    let k = 0;
    while (k < rest.length && (rest[k].text.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[k].text))) {
      if (/^-(u|C|S)$/.test(rest[k].text)) k++;
      k++;
    }
    return merge(analyseCommand(rest.slice(k), lang));
  }
  if (name === "timeout") {
    let k = 0;
    while (k < rest.length && rest[k].text.startsWith("-")) k += /^-(s|k)$/.test(rest[k].text) ? 2 : 1;
    return merge(analyseCommand(rest.slice(k + 1), lang));
  }
  if (name === "xargs") {
    let k = 0;
    while (k < rest.length && rest[k].text.startsWith("-")) k += /^-(I|L|n|P|s|d|E|a)$/.test(rest[k].text) ? 2 : 1;
    const inner = rest.slice(k);
    // The targets arrive on stdin, so they can never be verified here.
    const probe = analyseCommand([...inner, { text: "/", dynamic: false }], lang);
    if (probe.findings.length) {
      findings.push({ tool: probe.findings[0].tool, target: "(read from stdin by xargs)", reason: "its targets are piped in at run time, so none of them can be checked" });
    }
    return { findings, nested };
  }

  // Shells: `bash -c SCRIPT`, `bash -lc SCRIPT`, ...
  if (["bash", "sh", "zsh", "dash", "ksh"].includes(name)) {
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k].text;
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(t) && k + 1 < rest.length) {
        nested.push({ lang: "posix", src: rest[k + 1].text });
        break;
      }
      if (!t.startsWith("-")) break;
    }
    return { findings, nested };
  }

  // wsl.exe [options] [--] command...   /   wsl.exe -e command...
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
      if (/^(-d|--distribution|-u|--user|--cd|--shell-type|--distribution-id)$/.test(t)) {
        k += 2;
        continue;
      }
      if (t.startsWith("-")) {
        k++;
        continue;
      }
      break;
    }
    const inner = rest.slice(k);
    if (!inner.length) return { findings, nested };
    if (execMode) return merge(analyseCommand(inner, "posix"));
    // Without -e the remaining words are joined into a command line for the
    // distro's default shell, which re-parses them — so analyse that line.
    nested.push({ lang: "posix", src: inner.map((w) => shellQuote(w.text)).join(" ") });
    return { findings, nested };
  }

  // docker exec [options] CONTAINER command...
  if (name === "docker" || name === "podman") {
    if (rest[0]?.text !== "exec") return { findings, nested };
    let k = 1;
    while (k < rest.length && rest[k].text.startsWith("-")) {
      k += /^(-u|--user|-w|--workdir|-e|--env|--env-file|--detach-keys)$/.test(rest[k].text) ? 2 : 1;
    }
    return merge(analyseCommand(rest.slice(k + 1), "posix"));
  }

  // powershell / pwsh -Command SCRIPT
  if (name === "powershell" || name === "pwsh") {
    for (let k = 0; k < rest.length; k++) {
      if (/^-(c|command)$/i.test(rest[k].text)) {
        nested.push({ lang: "powershell", src: rest.slice(k + 1).map((w) => w.text).join(" ") });
        break;
      }
    }
    return { findings, nested };
  }

  // cmd /c LINE
  if (name === "cmd") {
    const k = rest.findIndex((w) => /^\/[ck]$/i.test(w.text));
    if (k !== -1) nested.push({ lang: "powershell", src: rest.slice(k + 1).map((w) => w.text).join(" ") });
    return { findings, nested };
  }

  // --- The destructive commands themselves --------------------------------

  if (name === "rm") {
    let recursive = false;
    const targets = [];
    let optsDone = false;
    for (const w of rest) {
      if (!optsDone && w.text === "--") {
        optsDone = true;
        continue;
      }
      if (!optsDone && /^--recursive$/.test(w.text)) recursive = true;
      else if (!optsDone && /^-[a-zA-Z]+$/.test(w.text)) {
        if (/[rR]/.test(w.text)) recursive = true;
      } else if (!optsDone && w.text.startsWith("--")) continue;
      else targets.push(w);
    }
    if (lang === "powershell") return merge(analysePowerShellRemove(args));
    if (recursive) checkTargets("rm -r", targets);
    return { findings, nested };
  }

  if (name === "find" && lang === "posix") {
    const exprStart = rest.findIndex((w) => /^[-(!]/.test(w.text) || w.text === "\\(");
    const starts = exprStart === -1 ? rest : rest.slice(0, exprStart);
    const expr = exprStart === -1 ? [] : rest.slice(exprStart);
    const deletes = expr.some((w, k) => w.text === "-delete" || (/^-(exec|execdir|ok|okdir)$/.test(w.text) && expr[k + 1] && base(expr[k + 1]) === "rm"));
    if (deletes) checkTargets("find -delete", starts.length ? starts : [{ text: ".", dynamic: false }]);
    return { findings, nested };
  }

  if (name === "rsync") {
    let deletes = false;
    const operands = [];
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k].text;
      if (t === "--del" || /^--delete(-[a-z]+)?$/.test(t) || t === "--remove-source-files") {
        if (t !== "--remove-source-files") deletes = true;
        continue;
      }
      if (RSYNC_ARG_OPTIONS.has(t)) {
        k++;
        continue;
      }
      if (t.startsWith("-")) continue;
      operands.push(rest[k]);
    }
    if (deletes && operands.length) {
      const dest = operands[operands.length - 1];
      const remote = /^(?:[^/:]*@)?([^/:]{2,}):(.*)$/.exec(dest.text);
      checkTargets("rsync --delete", [remote ? { text: remote[2] || ".", dynamic: dest.dynamic } : dest]);
    }
    return { findings, nested };
  }

  if (lang === "powershell") {
    if (["remove-item", "ri", "del", "erase", "rd", "rmdir"].includes(name)) return merge(analysePowerShellRemove(args));
    if (name === "robocopy") {
      const mirror = rest.some((w) => /^\/(mir|purge)$/i.test(w.text));
      const positional = rest.filter((w) => !w.text.startsWith("/"));
      if (mirror && positional.length >= 2) checkTargets("robocopy /MIR", [positional[1]]);
      return { findings, nested };
    }
  }

  return { findings, nested };

  function checkTargets(tool, targets) {
    for (const t of targets) {
      const reason = unsafeTargetReason(t);
      if (reason) findings.push({ tool, target: t.text, reason });
    }
  }

  function merge(sub) {
    findings.push(...sub.findings);
    nested.push(...sub.nested);
    return { findings, nested };
  }

  function analysePowerShellRemove(words) {
    const out = { findings: [], nested: [] };
    const psName = base(words[0]);
    let recursive = false;
    const targets = [];
    for (let k = 1; k < words.length; k++) {
      const t = words[k].text;
      if (/^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(t) || (/^\/s$/i.test(t) && (psName === "rd" || psName === "rmdir"))) {
        recursive = true;
        continue;
      }
      if (/^-(path|literalpath|lp|pspath)$/i.test(t) && words[k + 1]) {
        targets.push(words[++k]);
        continue;
      }
      if (/^[-/]/.test(t)) continue;
      targets.push(words[k]);
    }
    if (recursive) {
      for (const tgt of targets.flatMap(splitPowerShellList)) {
        const reason = unsafeTargetReason(tgt);
        if (reason) out.findings.push({ tool: `${words[0].text} (recursive)`, target: tgt.text, reason });
      }
    }
    return out;
  }
}

function splitPowerShellList(w) {
  return w.text.includes(",") ? w.text.split(",").filter(Boolean).map((text) => ({ text, dynamic: w.dynamic })) : [w];
}

function shellQuote(s) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Analyse a whole command string for the given tool. Returns the list of
 * unsafe findings (empty when the command is allowed).
 */
export function analyse(command, toolName = "Bash") {
  const findings = [];
  const queue = [{ lang: toolName === "PowerShell" ? "powershell" : "posix", src: command, depth: 0 }];
  while (queue.length) {
    const { lang, src, depth } = queue.shift();
    if (depth > 8) continue;
    const { commands, substitutions } = lang === "powershell" ? tokenizePowerShell(src) : tokenizePosix(src);
    for (const sub of substitutions) queue.push({ lang, src: sub, depth: depth + 1 });
    for (const argv of commands) {
      const res = analyseCommand(argv, lang);
      findings.push(...res.findings);
      for (const n of res.nested) queue.push({ ...n, depth: depth + 1 });
    }
  }
  return findings;
}

export function denyReason(findings) {
  const list = findings.map((f) => `  - \`${f.tool}\` target \`${f.target}\`: ${f.reason}`).join("\n");
  return `BLOCKED: recursive delete or mirror-sync with an unsafe target.
${list}

On 2026-09-15 a builder agent ran an rsync --delete "scratch copy" whose destination reached rsync as \`/\`. For thirteen minutes it deleted everything the user could write under the WSL root and, through /mnt/c, the Windows side too: three repos, every Windows Claude transcript, and the transcript holding the command itself. The destination was almost certainly a variable that expanded empty.

A recursive delete or mirror-sync must name its target as a LITERAL, specific path — never a filesystem, drive or mount root, a home directory, or an ancestor of one. If the path must come from a variable, use the fail-loud form \`"\${NAME:?}/specific-folder"\`: bash aborts on an empty NAME instead of collapsing to \`/\`. For scratch copies use a dedicated folder such as \`/tmp/<task>-<id>\` or the session scratchpad, spelled out in full.

DO NOT route around this: moving the command into a script file, piping targets through xargs, or asking another agent or session to run it are the same act. If this is a genuine false positive, STOP and tell the operator exactly what you were trying to delete and why.`;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || command === "") return;
  const findings = analyse(command, input.tool_name);
  if (!findings.length) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denyReason(findings),
      },
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
