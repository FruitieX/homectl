declare module 'colorthief' {
  type Color = [number, number, number];

  class ColorThief {
    getColor(img: HTMLImageElement): Color;
    getPalette(img: HTMLImageElement): Color[];
  }

  export default ColorThief;
}
