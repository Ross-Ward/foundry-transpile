package main

import (
	"fmt"
	"strconv"
	"strings"
)

func __f(x float64) string {
	s := strings.TrimRight(strconv.FormatFloat(x, 'f', 6, 64), "0")
	if strings.HasSuffix(s, ".") {
		s += "0"
	}
	return s
}

func __trunc(x float64) int {
	return int(x)
}

type Item struct {
	name string
	qty int
	price float64
}

func total(items []*Item) float64 {
	var sum float64 = 0.0
	for i := 0; (i < len(items)); i = (i + 1) {
		sum = (sum + (items[i].price * float64(items[i].qty)))
	}
	return sum
}

func tag(it *Item) string {
	return (((it.name + " x") + fmt.Sprint(it.qty)) + func() string { if (it.qty > 1) { return " (bulk)" }; return "" }())
}

func main() {
	var items []*Item = []*Item{&Item{name: "anvil", qty: 2, price: 19.5}, &Item{name: "tongs", qty: 1, price: 7.25}, &Item{name: "flux", qty: 6, price: 0.5}}
	for i := 0; (i < len(items)); i = (i + 1) {
		if (items[i].qty == 0) {
			continue
		}
		fmt.Println(tag(items[i]))
	}
	fmt.Println(__f(total(items)))
	fmt.Println(__trunc(total(items)))
	fmt.Println("=== FOUNDRY ==="[4:11])
	fmt.Println((len(items) >= 3))
}

