import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_DIR = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(ENV_DIR, '.env') });
dotenv.config({ path: path.join(ENV_DIR, '.env.local'), override: true });

export const CONFIG = {
  port: Number(process.env.PORT || 8080),
  rankingApiUrl: (process.env.RANKING_API_URL || 'https://ranking.cubingclub.com/api/v1').replace(/\/$/, ''),
  paymentApiUrl: (process.env.PAYMENT_API_URL || 'https://payment.cubingclub.com/api/v1').replace(/\/$/, ''),
  loginUrl: process.env.LOGIN_URL || 'http://localhost:8081/login',
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'cck_groups',
  },
};
