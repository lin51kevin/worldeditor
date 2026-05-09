import '@testing-library/jest-dom';
import i18n from './i18n';

// Force Chinese locale in tests so text assertions match zh translations
void i18n.changeLanguage('zh');
