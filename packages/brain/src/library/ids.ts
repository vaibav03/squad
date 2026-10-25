import { randomBytes } from 'node:crypto';

const token = () => randomBytes(16).toString('base64url');
export const newCourseId = (): string => `c_${token()}`;
export const newFileId = (): string => `f_${token()}`;
export const COURSE_ID_RE = /^c_[A-Za-z0-9_-]{22}$/;
export const FILE_ID_RE = /^f_[A-Za-z0-9_-]{22}$/;
