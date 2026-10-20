// Icons a folder can use. The browser draws them; the server only checks the id.
export const FOLDER_ICONS = [
  'folder', 'home', 'house', 'car', 'briefcase', 'school', 'medical', 'heart', 'star', 'receipt',
  'bank', 'money', 'shield', 'passport', 'id', 'plane', 'tools', 'book', 'camera', 'music',
  'photo', 'gift', 'calendar', 'cloud', 'lock', 'archive', 'cart', 'phone', 'baby', 'pet',
];

export const isFolderIcon = (value) => FOLDER_ICONS.includes(value);
