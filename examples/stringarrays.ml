func join(parts: string[], sep: string): string {
  let joined: string = "";
  for (let i: int = 0; i < len(parts); i = i + 1) {
    if (i > 0) { joined = joined + sep; }
    joined = joined + parts[i];
  }
  return joined;
}

func shout(words: string[]): void {
  for (let i: int = 0; i < len(words); i = i + 1) {
    words[i] = words[i] + "!";
  }
}

func count(words: string[], target: string): int {
  let n: int = 0;
  for (let i: int = 0; i < len(words); i = i + 1) {
    if (words[i] == target) { n = n + 1; }
  }
  return n;
}

func main(): void {
  let crew: string[] = ["ada", "grace", "ada", "alan"];
  print(len(crew));
  print(join(crew, ", "));
  print(count(crew, "ada"));
  shout(crew);
  print(join(crew, " "));
  crew[1] = "linus";
  print(crew[1] + " is 1 of " + len(crew));
}
