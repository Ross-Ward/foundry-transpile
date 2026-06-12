fn __f(x: f64) -> String {
    let mut s = format!("{:.6}", x);
    while s.ends_with('0') { s.pop(); }
    if s.ends_with('.') { s.push('0'); }
    s
}

struct Item {
    name: String,
    qty: i64,
    price: f64,
}

fn total(items: &mut Vec<Item>) -> f64 {
    let mut sum: f64 = 0.0;
    {
        let mut i: i64 = 0;
        while (i < (items.len() as i64)) {
            sum = (sum + (items[(i) as usize].price * ((items[(i) as usize].qty) as f64)));
            i = (i + 1);
        }
    }
    return sum;
}

fn tag(it: &mut Item) -> String {
    return format!("{}{}", format!("{}{}", format!("{}{}", it.name.clone(), " x".to_string()), it.qty), (if (it.qty > 1) { " (bulk)".to_string() } else { "".to_string() }));
}

fn main() {
    let mut items: Vec<Item> = vec![Item { name: "anvil".to_string(), qty: 2, price: 19.5 }, Item { name: "tongs".to_string(), qty: 1, price: 7.25 }, Item { name: "flux".to_string(), qty: 6, price: 0.5 }];
    {
        let mut i: i64 = 0;
        while (i < (items.len() as i64)) {
            if (items[(i) as usize].qty == 0) {
                i = (i + 1);
                continue;
            }
            println!("{}", tag(&mut items[(i) as usize]));
            i = (i + 1);
        }
    }
    println!("{}", __f(total(&mut items)));
    println!("{}", ((total(&mut items)) as i64));
    println!("{}", "=== FOUNDRY ===".to_string()[(4) as usize..(11) as usize].to_string());
    println!("{}", ((items.len() as i64) >= 3));
}
