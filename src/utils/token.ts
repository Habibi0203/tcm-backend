import { nanoid } from 'nanoid';

export function generateVerificationToken(): string {
  return nanoid(40);
}

export function generateResetToken(): string {
  return nanoid(40);
}

export const TOKEN_EXPIRY = {
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000, // 24 jam
  PASSWORD_RESET:     60 * 60 * 1000,      // 1 jam
};

export const JWT_EXPIRY = {
  ACCESS:  '15m',
  REFRESH: '7d',
};

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // seconds
