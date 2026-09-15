import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Facebook composer preview v2', () => {
  it('renders a dedicated Facebook feed card instead of the generic provider card', () => {
    const source = fs.readFileSync('src/PlannerComposerPreview.tsx', 'utf8');
    expect(source).toContain('SC_FACEBOOK_COMPOSER_PREVIEW_V2');
    expect(source).toContain('function FacebookPreview');
    expect(source).toContain('scfb-facebook-preview');
    expect(source).toContain('cleanFacebookPageName');
    expect(source).toContain('J’aime');
    expect(source).toContain('Commenter');
    expect(source).toContain('Partager');
    expect(source).not.toContain('<strong>{destination.accountLabel}</strong> {copy');
  });

  it('preserves the source media ratio for Facebook images', () => {
    const css = fs.readFileSync('src/facebook-preview-v2.css', 'utf8');
    expect(css).toContain('.scfb-media.image img');
    expect(css).toContain('height:auto');
    expect(css).toContain('object-fit:contain');
  });
});
