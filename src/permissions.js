// Role-based access control. Routes check a permission name, never a role name,
// so a new role can be added by editing this table only.
//
//   documents    - manage your own persons, folders and files
//   users:manage - create, disable, reset and delete user accounts
const PERMISSIONS = {
  super_admin: ['documents', 'users:manage'],
  user: ['documents'],
};

export const ROLES = Object.keys(PERMISSIONS);

export const permissionsFor = (role) => PERMISSIONS[role] ?? [];

export const can = (user, permission) => permissionsFor(user?.role).includes(permission);
