export const CATEGORIES = [
  { id: 'electronics', label: 'Электроника' },
  { id: 'appliances', label: 'Бытовая техника' },
  { id: 'furniture', label: 'Мебель' },
  { id: 'auto', label: 'Авто' },
  { id: 'other', label: 'Другое' },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]['id'];

export const ICONS = ['phone', 'laptop', 'console', 'sofa', 'kitchen', 'bag'] as const;
export type IconId = (typeof ICONS)[number];

const RULES: { re: RegExp; icon: IconId; category: CategoryId }[] = [
  { re: /(iphone|айфон|телефон|смартфон|samsung|самсунг|xiaomi|ксиоми|redmi|планшет|ipad)/i, icon: 'phone', category: 'electronics' },
  { re: /(ноутбук|macbook|laptop|компьютер|пк\b|монитор)/i, icon: 'laptop', category: 'electronics' },
  { re: /(playstation|ps[345]\b|xbox|консол|nintendo|приставк)/i, icon: 'console', category: 'electronics' },
  { re: /(диван|кресл|кровать|матрас|спальн|гостин|шкаф-купе|мебел|стол\b|стул)/i, icon: 'sofa', category: 'furniture' },
  { re: /(кухн|гарнитур)/i, icon: 'kitchen', category: 'furniture' },
  { re: /(холодильник|стиральн|посудомоечн|пылесос|кондиционер|духов|плита|микроволнов|телевизор|\bтв\b)/i, icon: 'bag', category: 'appliances' },
  { re: /(авто|машин|lada|лада|шин[аы]\b|мотоцикл|скутер)/i, icon: 'bag', category: 'auto' },
];

/** Ярлык и категория по названию товара (можно сменить вручную). */
export function guessProduct(title: string): { icon: IconId; category: CategoryId } {
  for (const r of RULES) if (r.re.test(title)) return { icon: r.icon, category: r.category };
  return { icon: 'bag', category: 'other' };
}

export const SELLER_TYPES = ['shop', 'person', 'none'] as const;
export type SellerType = (typeof SELLER_TYPES)[number];
