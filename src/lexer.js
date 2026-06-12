"use strict";
// Lexer for MiniLang — turns source text into a flat token stream.
// Tokens: keywords, identifiers, int/float/string literals, operators, punctuation.

const KEYWORDS = new Set([
  "func", "let", "if", "else", "while", "for", "return", "print",
  "true", "false", "int", "float", "bool", "string", "void", "struct",
]);

// Multi-char operators are matched before single-char ones.
const OPS3 = [];
const OPS2 = ["==", "!=", "<=", ">=", "&&", "||"];
const OPS1 = "+-*/%=<>!(){}[],;:.".split("");

class Token {
  constructor(kind, value, line, col) {
    this.kind = kind;   // "kw" | "id" | "int" | "float" | "str" | "op" | "eof"
    this.value = value;
    this.line = line;
    this.col = col;
  }
}

function lex(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const peek = (k = 0) => src[i + k];
  const adv = () => { const c = src[i++]; if (c === "\n") { line++; col = 1; } else col++; return c; };

  while (i < src.length) {
    const c = peek();

    if (c === " " || c === "\t" || c === "\r" || c === "\n") { adv(); continue; }

    // line comments
    if (c === "/" && peek(1) === "/") { while (i < src.length && peek() !== "\n") adv(); continue; }

    const startLine = line, startCol = col;

    // numbers (int or float)
    if (isDigit(c)) {
      let s = "";
      while (i < src.length && isDigit(peek())) s += adv();
      if (peek() === "." && isDigit(peek(1))) {
        s += adv(); // '.'
        while (i < src.length && isDigit(peek())) s += adv();
        toks.push(new Token("float", parseFloat(s), startLine, startCol));
      } else {
        toks.push(new Token("int", parseInt(s, 10), startLine, startCol));
      }
      continue;
    }

    // identifiers / keywords
    if (isIdentStart(c)) {
      let s = "";
      while (i < src.length && isIdentPart(peek())) s += adv();
      toks.push(new Token(KEYWORDS.has(s) ? "kw" : "id", s, startLine, startCol));
      continue;
    }

    // strings
    if (c === '"') {
      adv(); // opening quote
      let s = "";
      while (i < src.length && peek() !== '"') {
        let ch = adv();
        if (ch === "\\") { // simple escapes
          const e = adv();
          ch = e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e === '"' ? '"' : e;
        }
        s += ch;
      }
      if (peek() !== '"') throw new TranspileError(`unterminated string`, startLine, startCol);
      adv(); // closing quote
      toks.push(new Token("str", s, startLine, startCol));
      continue;
    }

    // operators
    const two = c + (peek(1) || "");
    if (OPS2.includes(two)) { adv(); adv(); toks.push(new Token("op", two, startLine, startCol)); continue; }
    if (OPS1.includes(c)) { adv(); toks.push(new Token("op", c, startLine, startCol)); continue; }

    throw new TranspileError(`unexpected character '${c}'`, startLine, startCol);
  }

  toks.push(new Token("eof", null, line, col));
  return toks;
}

function isDigit(c) { return c >= "0" && c <= "9"; }
function isIdentStart(c) { return /[A-Za-z_]/.test(c || ""); }
function isIdentPart(c) { return /[A-Za-z0-9_]/.test(c || ""); }

class TranspileError extends Error {
  constructor(message, line, col) {
    super(line ? `${message} (line ${line}:${col})` : message);
    this.name = "TranspileError";
  }
}

module.exports = { lex, Token, KEYWORDS, TranspileError };
