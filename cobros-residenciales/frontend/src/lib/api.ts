import axios from "axios";

const backendUrl = (import.meta.env.VITE_BACKEND_URL as string | undefined) || "http://localhost:8000";
const paymentsUrl = (import.meta.env.VITE_PAYMENTS_URL as string | undefined) || "http://localhost:8002";

export const backend = axios.create({
  baseURL: backendUrl,
});

export const payments = axios.create({
  baseURL: paymentsUrl,
});

export function setAuthToken(token: string | null) {
  if (token) {
    backend.defaults.headers.common.Authorization = `Bearer ${token}`;
    payments.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete backend.defaults.headers.common.Authorization;
    delete payments.defaults.headers.common.Authorization;
  }
}

export const serviceUrls = {
  backendUrl,
  paymentsUrl,
};

