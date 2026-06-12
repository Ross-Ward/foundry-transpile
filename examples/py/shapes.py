# Real Python classes become IR structs: field types are inferred from the
# __init__ call sites, and mutation through a function works on every target.
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

class Tally:
    def __init__(self, label, count):
        self.label = label
        self.count = count

def translate(p, dx, dy):
    p.x += dx
    p.y += dy

def bump(t, n):
    t.count += n
    t.label = t.label + "!"

def main():
    p = Point(2, 3)
    translate(p, 5, -1)
    print(p.x)
    print(p.y)
    print(p.x * p.y)
    t = Tally("run", 1)
    bump(t, 4)
    bump(t, 5)
    print(t.label)
    print(t.count)

main()
