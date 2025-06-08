import { query, style, group, animate } from '@angular/animations';

export const slideTo = (direction: 'left' | 'right') => [
  query(
    ':enter, :leave',
    [
      style({
        position: 'absolute',
        top: 0,
        width: '100%',
        [direction === 'left' ? 'left' : 'right']: 0, // Pin to the correct side
      }),
    ],
    { optional: true }
  ),
  query(':enter', [
      style({
          transform: `translateX(${direction === 'left' ? '100%' : '-100%'})`,
          opacity: 0,
        }),
    ]),
    group([
        query(
            ':leave',
            [
                animate(
                    '400ms ease-in-out',
                    style({
                        transform: `translateX(${direction === 'left' ? '-100%' : '100%'})`,
                        opacity: 0,
                    })
                ),
            ],
            { optional: true }
        ),
        query(':enter', [
            animate(
                '400ms ease-in-out',
                style({ transform: 'translateX(0)', opacity: 1 })
            ),
        ]),
    ]),
];
