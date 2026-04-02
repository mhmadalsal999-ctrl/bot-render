// storageService.js — Upload videos to Supabase Storage

import { supabase } from '../db/supabase.js';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';

const BUCKET = 'clips';

export async function uploadVideoToSupabase(localPath, filename) {
  logger.info('STORAGE', `Uploading ${filename}...`);

  const buffer = await fs.readFile(localPath);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, {
      contentType: 'video/mp4',
      upsert: true
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filename);

  logger.success('STORAGE', `Uploaded: ${urlData.publicUrl}`);
  return urlData.publicUrl;
}
