// Mock for lucide-react icons
import React from 'react';

// Create a mock component factory that returns a simple span
const createMockIcon = (name) => {
  const MockIcon = (props) => {
    return React.createElement('span', {
      'data-testid': `icon-${name}`,
      className: props.className,
      onClick: props.onClick,
      ...props
    });
  };
  MockIcon.displayName = `Mock${name}Icon`;
  return MockIcon;
};

// Export common icons used in the app
export const X = createMockIcon('X');
export const AlertTriangle = createMockIcon('AlertTriangle');
export const AlertCircle = createMockIcon('AlertCircle');
export const Check = createMockIcon('Check');
export const CheckCircle = createMockIcon('CheckCircle');
export const Info = createMockIcon('Info');
export const ChevronDown = createMockIcon('ChevronDown');
export const ChevronUp = createMockIcon('ChevronUp');
export const Plus = createMockIcon('Plus');
export const Minus = createMockIcon('Minus');
export const ExternalLink = createMockIcon('ExternalLink');
export const Copy = createMockIcon('Copy');
export const Shield = createMockIcon('Shield');
export const RefreshCw = createMockIcon('RefreshCw');

// Default export in case it's needed
export default {
  X,
  AlertTriangle,
  AlertCircle,
  Check,
  CheckCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
  ExternalLink,
  Copy,
  Shield,
  RefreshCw,
};

