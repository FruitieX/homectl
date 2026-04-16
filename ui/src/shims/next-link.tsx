import { forwardRef } from 'react';
import { Link as RouterLink, type To } from 'react-router-dom';

type LinkProps = Omit<React.ComponentProps<typeof RouterLink>, 'to'> & {
  href: To;
  locale?: string | false;
  passHref?: boolean;
  prefetch?: boolean;
  scroll?: boolean;
  shallow?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    href,
    locale: _locale,
    passHref: _passHref,
    prefetch: _prefetch,
    scroll: _scroll,
    shallow: _shallow,
    ...props
  },
  ref,
) {
  return <RouterLink ref={ref} to={href} {...props} />;
});

export default Link;