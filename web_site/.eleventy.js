module.exports = function(eleventyConfig) {
  // Pass through static assets unchanged
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy("sitemap.xml");
  eleventyConfig.addPassthroughCopy("**/*.{png,jpg,jpeg,gif,svg,ico,webp}");

  // These HTML files have no front matter — ignore from template engine, copy as-is
  const staticHtml = [
    "Chinese-Slang-Translator/index.html",
    "Chinese-Slang-Translator/support.html",
    "Chinese-Slang-Translator/legal.html",
    "Chinese-Slang-Translator/refund.html",
    "index.html",
  ];
  staticHtml.forEach(f => {
    eleventyConfig.ignores.add(f);
    eleventyConfig.addPassthroughCopy(f);
  });

  // Glossary collection — picks up all .md files in _glossary/
  eleventyConfig.addCollection("glossary", function(collectionApi) {
    return collectionApi.getFilteredByGlob("_glossary/*.md");
  });

  return {
    templateFormats: ["md", "html"],
    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: false,
    dir: {
      layouts: "_layouts",
      output: "_site"
    }
  };
};
