struct Inner {
  v: int;
}

struct Pack {
  name: string;
  inner: Inner;
}

func bump(i: Inner): void {
  i.v = i.v + 1;
}

func main(): void {
  let p: Pack = Pack("kit", Inner(5));
  print(p.inner.v);
  bump(p.inner);
  print(p.inner.v);
  p.inner.v = 10;
  print(p.inner.v);
  p.inner = Inner(99);
  print(p.inner.v);
  print(p.name + " " + p.inner.v);
}
