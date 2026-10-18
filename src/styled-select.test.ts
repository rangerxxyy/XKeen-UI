import { describe, expect, it } from 'vitest';
import { navigateStyledOptions, readStyledSelectOptions } from './styled-select';

describe('styled select navigation', () => {
  const options = [{ disabled:false, hidden:false }, { disabled:true, hidden:false }, { disabled:false, hidden:true }, { disabled:false, hidden:false }];
  it('skips unavailable options and wraps in both directions', () => {
    expect(navigateStyledOptions(options,0,'ArrowDown')).toBe(3);
    expect(navigateStyledOptions(options,3,'ArrowDown')).toBe(0);
    expect(navigateStyledOptions(options,0,'ArrowUp')).toBe(3);
  });
  it('finds first/last enabled items even when the current selection is unavailable', () => {
    expect(navigateStyledOptions(options,1,'Home')).toBe(0);
    expect(navigateStyledOptions(options,1,'End')).toBe(3);
    expect(navigateStyledOptions(options,-1,'ArrowUp')).toBe(3);
    expect(navigateStyledOptions(options,1,'ArrowDown')).toBe(0);
  });
  it('has no target when empty or entirely unavailable', () => {
    expect(navigateStyledOptions([],0,'Home')).toBe(-1);
    expect(navigateStyledOptions(options.slice(1,3),0,'ArrowDown')).toBe(-1);
  });
});

describe('native option snapshots', () => {
  it('preserves native indexes, option labels, and disabled/hidden optgroups', () => {
    const group = { tagName:'OPTGROUP', label:'Regional', disabled:true, hidden:false };
    const select = { options:[
      { label:'Displayed label', disabled:false, hidden:false, parentElement:{tagName:'SELECT'} },
      { label:'Grouped', disabled:false, hidden:false, parentElement:group },
      { label:'Hidden', disabled:false, hidden:false, parentElement:{...group,disabled:false,hidden:true} },
    ] } as unknown as HTMLSelectElement;
    expect(readStyledSelectOptions(select)).toEqual([
      {label:'Displayed label',disabled:false,hidden:false,group:''},
      {label:'Grouped',disabled:true,hidden:false,group:'Regional'},
      {label:'Hidden',disabled:false,hidden:true,group:'Regional'},
    ]);
  });
});
