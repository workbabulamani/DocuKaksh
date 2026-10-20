// Role-based access control. Routes check a permission name, never a role name,
// so a new role can be added by editing this table only.
//
//   documents          view and change folders and files in persons you can access
//   persons:manage     create, rename, reorder and delete persons
//   users:manage       create, disable, reset and delete accounts; assign persons
//   recovery:manage    review "forgot password" requests
//   trash:manage       open the recycle bin, restore and permanently delete
//   system:manage     audit log, health and metrics page
const PERMISSIONS = {
  super_admin: ['documents', 'persons:manage', 'users:manage', 'recovery:manage', 'trash:manage', 'system:manage'],
  user: ['documents'],
};

export const ROLES = Object.keys(PERMISSIONS);

export const permissionsFor = (role) => PERMISSIONS[role] ?? [];

export const can = (user, permission) => permissionsFor(user?.role).includes(permission);

// Themes offered in Settings. "day" and "night" are the required defaults.
export const THEMES = [
  'day', 'night', 'nord', 'dracula', 'solarized-light', 'solarized-dark',
  'gruvbox-dark', 'catppuccin-mocha', 'tokyo-night', 'rose-pine-dawn',
  'one-dark', 'monokai', 'github-light', 'everforest-light', 'ayu-dark', 'material-ocean',
  'lime',
];

// Languages the interface can be shown in. Codes are stored per account.
export const LANGUAGE_CODES = ['en', 'hi', 'bn', 'te', 'ta', 'mr', 'ur', 'es', 'fr', 'de', 'zh', 'ar'];
