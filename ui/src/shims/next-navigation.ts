import { useLocation, useNavigate } from 'react-router-dom';

export function usePathname() {
  return useLocation().pathname;
}

export function useRouter() {
  const navigate = useNavigate();

  return {
    back: () => navigate(-1),
    forward: () => navigate(1),
    push: (to: string) => navigate(to),
    refresh: () => window.location.reload(),
    replace: (to: string) => navigate(to, { replace: true }),
  };
}

export function redirect(to: string): never {
  window.location.replace(to);
  return undefined as never;
}