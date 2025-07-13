export const getUvIndexColor = (uvIndex_: number): string => {
  const uvIndex = Math.round(uvIndex_);

  if (uvIndex <= 2) {
    return 'text-green-500';
  } else if (uvIndex <= 5) {
    return 'text-yellow-500';
  } else if (uvIndex <= 7) {
    return 'text-orange-500';
  } else if (uvIndex <= 10) {
    return 'text-red-500';
  } else {
    return 'text-purple-500';
  }
};
