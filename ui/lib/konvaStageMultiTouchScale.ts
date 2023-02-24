import { Stage } from 'konva/lib/Stage';
import { Vector2d } from 'konva/lib/types';

const getDistance = (p1: Vector2d, p2: Vector2d): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

const getCenter = (p1: Vector2d, p2: Vector2d): Vector2d => {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
};

export const konvaStageMultiTouchScale = (
  stage: Stage,
  onDragStart: () => void,
) => {
  let lastCenter: Vector2d | null = null;
  let lastDist = 0;

  stage.removeEventListener('touchmove');
  stage.removeEventListener('touchend');
  stage.removeEventListener('wheel');

  stage.on('wheel', function (e) {
    e.evt.preventDefault();

    const scaleBy = 1.1;
    const oldScale = stage.scaleX();

    const pointerPos = stage.getPointerPosition() ?? { x: 0, y: 0 };

    const mousePointTo = {
      x: pointerPos.x / oldScale - stage.x() / oldScale,
      y: pointerPos.y / oldScale - stage.y() / oldScale,
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

    const newPos = {
      x: (pointerPos.x / newScale - mousePointTo.x) * newScale,
      y: (pointerPos.y / newScale - mousePointTo.y) * newScale,
    };
    stage.scaleX(newScale);
    stage.scaleY(newScale);
    stage.position(newPos);
  });

  stage.on('touchmove', function (e) {
    e.evt.preventDefault();
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];

    if (touch1 && touch2) {
      onDragStart();

      stage.draggable(false);
      // if the stage was under Konva's drag&drop
      // we need to stop it, and implement our own pan logic with two pointers
      if (stage.isDragging()) {
        stage.stopDrag();
      }

      const p1 = {
        x: touch1.clientX,
        y: touch1.clientY,
      };
      const p2 = {
        x: touch2.clientX,
        y: touch2.clientY,
      };

      if (!lastCenter) {
        lastCenter = getCenter(p1, p2);
        return;
      }
      const newCenter = getCenter(p1, p2);

      const dist = getDistance(p1, p2);

      if (!lastDist) {
        lastDist = dist;
      }

      // local coordinates of center point
      const pointTo = {
        x: (newCenter.x - stage.x()) / stage.scaleX(),
        y: (newCenter.y - stage.y()) / stage.scaleX(),
      };

      const scale = stage.scaleX() * (dist / lastDist);

      stage.scaleX(scale);
      stage.scaleY(scale);

      // calculate new position of the stage
      const dx = newCenter.x - lastCenter.x;
      const dy = newCenter.y - lastCenter.y;

      const newPos = {
        x: newCenter.x - pointTo.x * scale + dx,
        y: newCenter.y - pointTo.y * scale + dy,
      };

      stage.position(newPos);

      lastDist = dist;
      lastCenter = newCenter;
    }
  });

  stage.on('touchend', function () {
    lastDist = 0;
    lastCenter = null;
    stage.draggable(true);
  });
};
