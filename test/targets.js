"use strict";
// Shared target-runner for the verification harness and the fuzzer: knows how
// to compile/run a generated program for every backend and normalize output.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const isWin = process.platform === "win32";
const TOOLS = {
  node: process.execPath,
  python: process.env.TRANSPILE_PYTHON || (isWin ? "python" : "python3"),
  zig: process.env.TRANSPILE_ZIG || "zig",
  go: process.env.TRANSPILE_GO || "go",
  java: process.env.TRANSPILE_JAVA || "java",
  rustc: process.env.TRANSPILE_RUST || "rustc",
  dotnet: process.env.TRANSPILE_DOTNET || "dotnet",
  lua: process.env.TRANSPILE_LUA || "lua",
  kotlinc: process.env.TRANSPILE_KOTLINC || (isWin ? "kotlinc.bat" : "kotlinc"),
  php: process.env.TRANSPILE_PHP || "php",
  dart: process.env.TRANSPILE_DART || "dart",
};
const TARGETS = ["js", "python", "c", "go", "java", "csharp", "rust", "lua", "kotlin", "zig", "php", "dart"];

// kotlinc needs JAVA_HOME; derive it from the java override when it's a path
const JAVA_HOME = process.env.TRANSPILE_JAVA_HOME ||
  (path.isAbsolute(TOOLS.java) ? path.dirname(path.dirname(TOOLS.java)) : process.env.JAVA_HOME);

function runTarget(target, code, dir, name) {
  const f = (ext) => path.join(dir, `${name}.${ext}`);
  switch (target) {
    case "js": {
      fs.writeFileSync(f("js"), code);
      return cp.execFileSync(TOOLS.node, [f("js")], { encoding: "utf8" });
    }
    case "python": {
      fs.writeFileSync(f("py"), code);
      return cp.execFileSync(TOOLS.python, [f("py")], { encoding: "utf8" });
    }
    case "c": {
      fs.writeFileSync(f("c"), code);
      const exe = path.join(dir, isWin ? `${name}.exe` : name);
      cp.execFileSync(TOOLS.zig, ["cc", "-O2", "-w", f("c"), "-o", exe], { encoding: "utf8" });
      return cp.execFileSync(exe, [], { encoding: "utf8" });
    }
    case "go": {
      fs.writeFileSync(f("go"), code);
      return cp.execFileSync(TOOLS.go, ["run", f("go")], { encoding: "utf8", env: process.env });
    }
    case "java": {
      fs.writeFileSync(f("java"), code); // JEP 330 single-file launch; filename need not match class
      return cp.execFileSync(TOOLS.java, [f("java")], { encoding: "utf8" });
    }
    case "rust": {
      fs.writeFileSync(f("rs"), code);
      const exe = path.join(dir, isWin ? `${name}_r.exe` : `${name}_r`);
      cp.execFileSync(TOOLS.rustc, ["-O", "-A", "warnings", f("rs"), "-o", exe], { encoding: "utf8" });
      return cp.execFileSync(exe, [], { encoding: "utf8" });
    }
    case "csharp": {
      const projDir = path.join(dir, "_cs");
      if (!fs.existsSync(projDir)) {
        fs.mkdirSync(projDir);
        fs.writeFileSync(path.join(projDir, "tp.csproj"),
          '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>' +
          '<TargetFramework>net9.0</TargetFramework><Nullable>disable</Nullable>' +
          // dotnet run prints warnings to stdout; CS8981 fires on lowercase type names
          '<NoWarn>CS8981</NoWarn>' +
          '<InvariantGlobalization>true</InvariantGlobalization></PropertyGroup></Project>');
      }
      fs.writeFileSync(path.join(projDir, "Program.cs"), code);
      return cp.execFileSync(TOOLS.dotnet, ["run", "-c", "Release", "--project", projDir], { encoding: "utf8", env: process.env });
    }
    case "lua": {
      fs.writeFileSync(f("lua"), code);
      return cp.execFileSync(TOOLS.lua, [f("lua")], { encoding: "utf8" });
    }
    case "kotlin": {
      fs.writeFileSync(f("kt"), code);
      const jar = path.join(dir, `${name}.jar`);
      const env = JAVA_HOME ? { ...process.env, JAVA_HOME } : process.env;
      // .bat scripts need a shell on Windows
      cp.execFileSync(TOOLS.kotlinc, [f("kt"), "-nowarn", "-include-runtime", "-d", jar], { encoding: "utf8", env, shell: isWin });
      return cp.execFileSync(TOOLS.java, ["-jar", jar], { encoding: "utf8" });
    }
    case "zig": {
      fs.writeFileSync(f("zig"), code);
      return cp.execFileSync(TOOLS.zig, ["run", f("zig")], { encoding: "utf8" });
    }
    case "php": {
      fs.writeFileSync(f("php"), code);
      return cp.execFileSync(TOOLS.php, [f("php")], { encoding: "utf8" });
    }
    case "dart": {
      fs.writeFileSync(f("dart"), code);
      return cp.execFileSync(TOOLS.dart, ["run", f("dart")], { encoding: "utf8", shell: isWin }); // dart.bat on Windows
    }
    default: throw new Error("unknown target " + target);
  }
}

const norm = (s) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");

module.exports = { TOOLS, TARGETS, runTarget, norm, isWin };
