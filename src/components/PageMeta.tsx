import { useEffect } from 'react';

interface FAQItem {
  question: string;
  answer: string;
}

interface PageMetaProps {
  title: string;
  description?: string;
  faqItems?: FAQItem[];
}

const SITE_NAME = 'Работа для Всех';

export const PageMeta = ({ title, description, faqItems }: PageMetaProps) => {
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

    // Add FAQ JSON-LD schema
    if (faqItems && faqItems.length > 0) {
      // Remove existing FAQ schema if any
      const existingFaqSchema = document.querySelector('script[data-schema="faq"]');
      if (existingFaqSchema) {
        existingFaqSchema.remove();
      }

      const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faqItems.map(item => ({
          "@type": "Question",
          "name": item.question,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": item.answer
          }
        }))
      };

      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-schema', 'faq');
      script.textContent = JSON.stringify(faqSchema);
      document.head.appendChild(script);

      return () => {
        script.remove();
      };
    }
  }, [title, description, faqItems]);

  return null;
};

export default PageMeta;