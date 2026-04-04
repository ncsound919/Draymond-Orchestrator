import { redirect } from 'next/navigation';

/**
 * Dashboard root — redirects to Operations Center.
 * This keeps `/` clean while Operations remains the primary view.
 */
export default function Home() {
  redirect('/operations');
}
