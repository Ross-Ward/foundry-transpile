# Float lists from real Python: element types are inferred from the literal
# and flow into the typed targets' parameters.
def total_of(xs):
    t = 0.5
    for i in range(len(xs)):
        t += xs[i]
    return t

def main():
    readings = [1.25, 2.5, 0.5]
    print(total_of(readings))
    readings[1] = 4.25
    print(total_of(readings))
    print(len(readings))

main()
