import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
  logger.error('SUPABASE', 'SUPABASE_URL or SUPABASE_KEY missing');
  process.exit(1);
}

export const supabase = createClient(url, key);
logger.success('SUPABASE', 'Client initialized');
