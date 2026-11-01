import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {RecordStatusChip} from '../RecordStatusChip';

describe('RecordStatusChip', () => {
  it('labels not_retrieved "Not retrieved"', () => {
    render(<RecordStatusChip status="not_retrieved" />);
    expect(screen.getByText('Not retrieved')).toBeInTheDocument();
  });
});
