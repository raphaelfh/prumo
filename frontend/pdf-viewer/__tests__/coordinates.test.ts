import {describe, expect, it} from 'vitest';
import {projectPdfRectToCss} from '../core/coordinates';

describe('projectPdfRectToCss', () => {
  it('projects at scale=1 with Y-flip', () => {
    // pageHeight=792, rect={x:100, y:200, width:150, height:50}
    // expected: left=100, top=(792-200-50)*1=542, width=150, height=50
    const result = projectPdfRectToCss({x: 100, y: 200, width: 150, height: 50}, 792, 1);
    expect(result).toEqual({left: 100, top: 542, width: 150, height: 50});
  });

  it('projects at scale=1.5 with Y-flip', () => {
    // scale=1.5: left=100*1.5=150, top=(792-200-50)*1.5=813, width=150*1.5=225, height=50*1.5=75
    const result = projectPdfRectToCss({x: 100, y: 200, width: 150, height: 50}, 792, 1.5);
    expect(result).toEqual({left: 150, top: 813, width: 225, height: 75});
  });

  it('projects at scale=2 with Y-flip', () => {
    // rect at origin bottom: x=0, y=0, width=50, height=30
    // top=(792-0-30)*2=1524, left=0, width=100, height=60
    const result = projectPdfRectToCss({x: 0, y: 0, width: 50, height: 30}, 792, 2);
    expect(result).toEqual({left: 0, top: 1524, width: 100, height: 60});
  });

  it('projects at scale=0.5', () => {
    // left=10*0.5=5, top=(200-50-20)*0.5=65, width=100*0.5=50, height=20*0.5=10
    const result = projectPdfRectToCss({x: 10, y: 50, width: 100, height: 20}, 200, 0.5);
    expect(result).toEqual({left: 5, top: 65, width: 50, height: 10});
  });

  it('projects a rect at the top of the page (near pageHeight)', () => {
    // rect near top: y=750, height=30 → top=(792-750-30)*1=12
    const result = projectPdfRectToCss({x: 0, y: 750, width: 100, height: 30}, 792, 1);
    expect(result).toEqual({left: 0, top: 12, width: 100, height: 30});
  });
});
