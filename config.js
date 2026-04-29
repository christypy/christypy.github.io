const CONFIG = {

  // ☕ 義式基礎飲品
    BASE_DRINKS: [
        { name: "熱美式", price: 70 },
        { name: "冰美式", price: 75 },
        { name: "大熱美", price: 80 },
        { name: "淺焙美式", price: 130 },
        { name: "熱拿鐵", price: 85 },
        { name: "冰拿鐵", price: 85 },
        { name: "大熱拿", price: 95 },
        { name: "淺焙拿鐵", price: 150 },
        { name: "熱牛奶", price: 50 },
        { name: "抹茶歐蕾", price: 85 },
        { name: "可可歐蕾", price: 85 }
    ],

    // 📦 其他品項
    OTHER_ITEMS: [
        { name: "酸柑茶(小8包)", price: 160 },
        { name: "即溶(1條)", price: 16 },
        { name: "酸柑茶(大50包)", price: 950 },
        { name: "即溶(盒30條)", price: 475 },
        { name: "酸柑茶(100包)", price: 1440 },
        { name: "即溶(袋100條)", price: 1450 },
        { name: "小濾紙", price: 120 },
        { name: "大濾紙", price: 130 },
        { name: "濾掛紙(50個)", price: 150 },
        {name:"玻璃壺",price:400},
        {name:"玻璃壺(大)",price:500}
    ],
    // 飲品代碼對應名稱
    TYPE_NAMES: {
        hot_am: '☕ 熱美式', 
        ice_am: '🧊 冰美式', 
        large_hot_am: "☕️ 大熱美",
        hot_latte: '🔥 熱拿鐵', 
        hot_latte_sugar: '🍬 熱拿鐵 (加糖)',
        ice_latte_sugar: '🍭 冰拿鐵 (加糖)', 
        ice_latte: '❄️ 冰拿鐵',
        large_hot_latte: '🥤 大熱拿', 
        hand_drip: '💧 手沖', 
        potential_item: '❓ 待確認'
    },

    MENU_DATA: [
  { name: "覺", takeout: 200, dinein: 250, halfPound: 950, drip: 60, pack10: "" },
  { name: "花", takeout: 180, dinein: 230, halfPound: 850, drip: 55, pack10: "" },
  { name: "寶", takeout: 180, dinein: 230, halfPound: 850, drip: 55, pack10: "" },
  { name: "菩", takeout: 130, dinein: 180, halfPound: 700, drip: 45, pack10: "" },
  { name: "雅(4/14:200度)", takeout: 130, dinein: 180, halfPound: 700, drip: 45, pack10: "" },
  { name: "靜", takeout: 130, dinein: 180, halfPound: 650, drip: 45, pack10: "" },
  { name: "果", takeout: 130, dinein: 180, halfPound: 600, drip: 45, pack10: 360 },
  { name: "定", takeout: 130, dinein: 180, halfPound: 650, drip: 45, pack10: "" },
  { name: "幻", takeout: 130, dinein: 180, halfPound: 680, drip: 45, pack10: "" },
    { name: "福", takeout: 130, dinein: 180, halfPound: 550, drip: 40, pack10: "" },

   { name: "實", takeout: 130, dinein: 180, halfPound: 550, drip: 40, pack10: "" },
     { name: "柔", takeout: 130, dinein: 180, halfPound: 480, drip: 35, pack10: "" }

]};
