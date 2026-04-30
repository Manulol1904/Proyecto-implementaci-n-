export type Role = "admin" | "resident";

export type Me = {
  _id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
};

const KEY = "cobros_token";

export function getToken(): string | null {
  return localStorage.getItem(KEY);
}

export function setToken(token: string) {
  localStorage.setItem(KEY, token);
}

export function clearToken() {
  localStorage.removeItem(KEY);
}

