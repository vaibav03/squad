// Fluent 3D portraits (MIT, see assets/fluent-characters/LICENSE). Imported as modules so Vite fingerprints them.
import bear from '../../../../../assets/fluent-characters/personas/persona-01-mascot-bear.png';
import owl from '../../../../../assets/fluent-characters/personas/persona-02-mascot-alt-owl.png';
import teacher from '../../../../../assets/fluent-characters/personas/persona-03-examiner-teacher.png';
import mage from '../../../../../assets/fluent-characters/personas/persona-04-chapter-expert-mage.png';
import ninja from '../../../../../assets/fluent-characters/personas/persona-05-rival-ninja.png';
import a1 from '../../../../../assets/fluent-characters/avatars/avatar-01-woman-student-light.png';
import a2 from '../../../../../assets/fluent-characters/avatars/avatar-02-man-student-dark.png';
import a3 from '../../../../../assets/fluent-characters/avatars/avatar-03-student-medium.png';
import a4 from '../../../../../assets/fluent-characters/avatars/avatar-04-woman-coder-dark.png';
import a5 from '../../../../../assets/fluent-characters/avatars/avatar-05-man-coder-medium-light.png';
import a6 from '../../../../../assets/fluent-characters/avatars/avatar-06-woman-scientist-medium-dark.png';

export const PORTRAITS: Record<string, string> = {
  'persona-01-mascot-bear': bear,
  'persona-02-mascot-alt-owl': owl,
  'persona-03-examiner-teacher': teacher,
  'persona-04-chapter-expert-mage': mage,
  'persona-05-rival-ninja': ninja,
  'avatar-01': a1,
  'avatar-02': a2,
  'avatar-03': a3,
  'avatar-04': a4,
  'avatar-05': a5,
  'avatar-06': a6,
};
export const AVATAR_CHOICES = [
  { id: 'avatar-01', label: 'Student, light skin' },
  { id: 'avatar-02', label: 'Student, dark skin' },
  { id: 'avatar-03', label: 'Student, medium skin' },
  { id: 'avatar-04', label: 'Coder, dark skin' },
  { id: 'avatar-05', label: 'Coder, medium-light skin' },
  { id: 'avatar-06', label: 'Scientist, medium-dark skin' },
  { id: 'persona-01-mascot-bear', label: 'Bear' },
  { id: 'persona-02-mascot-alt-owl', label: 'Owl' },
  { id: 'persona-03-examiner-teacher', label: 'Teacher' },
  { id: 'persona-04-chapter-expert-mage', label: 'Mage' },
  { id: 'persona-05-rival-ninja', label: 'Ninja' },
] as const;
