# Real Python: a list reversed in place by a function (lists pass by reference),
# len(), indexing, and a range loop. Matches across all 7 other targets.
def reverse(a):
    n = len(a)
    i = 0
    while i < n // 2:
        tmp = a[i]
        a[i] = a[n - 1 - i]
        a[n - 1 - i] = tmp
        i += 1


def main():
    nums = [1, 2, 3, 4, 5]
    reverse(nums)
    print(nums[0])          # 5
    print(nums[4])          # 1
    total = 0
    for i in range(len(nums)):
        total += nums[i]
    print(total)            # 15


main()
