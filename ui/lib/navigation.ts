type Item = {
  name: string;
  slug: string;
  description?: string;
  isDisabled?: boolean;
};

export const navigation: Item[] = [
  {
    name: 'Dashboard',
    slug: '',
    description: 'Dashboard',
  },
];
