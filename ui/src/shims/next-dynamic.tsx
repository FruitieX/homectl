import { ComponentType, Suspense, lazy } from 'react';

type DynamicLoader<TProps extends object> = () => Promise<{
  default: ComponentType<TProps>;
}>;

type DynamicOptions = {
  loading?: () => React.ReactNode;
  ssr?: boolean;
};

export default function dynamicImport<TProps extends object>(
  loader: DynamicLoader<TProps>,
  options: DynamicOptions = {},
): ComponentType<TProps> {
  const LazyComponent = lazy(loader);

  return function DynamicComponent(props: TProps) {
    return (
      <Suspense fallback={options.loading ? options.loading() : null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}