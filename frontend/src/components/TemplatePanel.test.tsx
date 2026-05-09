import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TemplatePanel } from './TemplatePanel';

describe('TemplatePanel', () => {
  it('renders template panel', () => {
    render(<TemplatePanel />);

    expect(screen.getByText('模板')).toBeInTheDocument();
  });

  it('shows road templates', () => {
    render(<TemplatePanel />);

    ['单车道', '双向2车道', '双向4车道带路肩', '双向6车道带路肩'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});
