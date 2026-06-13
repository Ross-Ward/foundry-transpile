<?php

function __f(float $x): string {
    $s = rtrim(number_format($x, 6, ".", ""), "0");
    if (substr($s, -1) === ".") $s .= "0";
    return $s;
}

class Item {
    public function __construct(public $name, public $qty, public $price) {}
}

function total(&$items) {
    $sum = 0.0;
    for ($i = 0; ($i < count($items)); $i = ($i + 1)) {
        $sum = ($sum + ($items[$i]->price * (float)($items[$i]->qty)));
    }
    return $sum;
}

function tag($it) {
    return ((($it->name . ' x') . $it->qty) . ((($it->qty > 1)) ? ' (bulk)' : ''));
}

function main() {
    $items = [new Item('anvil', 2, 19.5), new Item('tongs', 1, 7.25), new Item('flux', 6, 0.5)];
    for ($i = 0; ($i < count($items)); $i = ($i + 1)) {
        if (($items[$i]->qty === 0)) {
            continue;
        }
        echo tag($items[$i]), "\n";
    }
    echo __f(total($items)), "\n";
    echo (int)(total($items)), "\n";
    echo substr('=== FOUNDRY ===', 4, (11) - (4)), "\n";
    echo ((count($items) >= 3)) ? "true" : "false", "\n";
}

main();
