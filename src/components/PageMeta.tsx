import { useEffect } from 'react';

interface PageMetaProps {
  title: string;
  description?: string;
}

const SITE_NAME = 'Работа для Всех';

export const PageMeta = ({ title, description }: PageMetaProps) => {
  useEffect(() => {
    // Update title
    document.title = `${title} | ${SITE_NAME}`;

    // Update meta description
    if (description) {
      let metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        metaDescription.setAttribute('content', description);
      }
    }

    // Update OG title
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.setAttribute('content', `${title} | ${SITE_NAME}`);
    }

    // Update OG description
    if (description) {
      let ogDescription = document.querySelector('meta[property="og:description"]');
      if (ogDescription) {
        ogDescription.setAttribute('content', description);
      }
    }
  }, [title, description]);

  return null;
};

export default PageMeta;