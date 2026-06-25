export interface Issue {
  original_phrase: string;
  issue_type: string;
  warning_description: string;
  corrected_phrase: string;
}

export interface Document {
  id: string;
  file_name: string;
  file_type: string;
  google_drive_link: string;
  created_at: string;
  status: 'pass' | 'fail';
  original_text: string;
  warning_message: string; // stringified JSON Array of Issue
  recommended_text: string;
}

export interface FileUploadStatus {
  file: File;
  progress: number;
  status: 'idle' | 'uploading' | 'completed' | 'failed';
  error?: string;
}
