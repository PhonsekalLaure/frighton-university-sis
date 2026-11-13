import { useState } from 'react';
import { UserRound } from 'lucide-react';

export function StudentAvatar({ src, name, className = '', alt = `${name}'s profile photo` }: {
  src?: string | null; name: string; className?: string; alt?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const classes = `profile-avatar student-avatar ${className}`;
  return src && src !== failedSrc
    ? <img className={classes} src={src} alt={alt} onError={() => setFailedSrc(src)} />
    : <span className={classes} role="img" aria-label={`Default profile picture for ${name}`}><UserRound aria-hidden="true" /></span>;
}
