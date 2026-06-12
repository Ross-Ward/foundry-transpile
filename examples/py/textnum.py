# Slices, len() on strings, and int()/float() casts from real Python —
# int() truncates toward zero on every target.
def head(s, n):
    return s[0:n]

def main():
    w = "foundry"
    print(len(w))
    print(head(w, 4))
    print(w[3:7])
    print(int(9.7))
    print(int(-9.7))
    x = float(3) / 2.0
    print(x)

main()
