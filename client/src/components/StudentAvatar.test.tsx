import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { StudentAvatar } from './StudentAvatar';

afterEach(cleanup);

test('missing and broken photos fall back to the person icon, and a new photo can load', () => {
  const { rerender } = render(<StudentAvatar name="Demo Student" />);
  expect(screen.getByRole('img', { name: 'Default profile picture for Demo Student' })).toContainHTML('<svg');
  rerender(<StudentAvatar name="Demo Student" src="https://example.invalid/broken.jpg" />);
  const photo = screen.getByAltText("Demo Student's profile photo");
  fireEvent.error(photo);
  expect(screen.getByRole('img', { name: 'Default profile picture for Demo Student' })).toContainHTML('<svg');
  rerender(<StudentAvatar name="Demo Student" src="https://example.invalid/new.jpg" />);
  expect(screen.getByAltText("Demo Student's profile photo")).toHaveAttribute('src', 'https://example.invalid/new.jpg');
});
