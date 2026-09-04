/** Core-facing AWS catalog seam. Entries are pure data and carry no AWS client or credentials. */
export {
  AWS_CATALOG,
  searchAwsCatalog,
  type AwsAvailability,
  type AwsCatalogCategory,
  type AwsCatalogEntry,
  type AwsCatalogSearchOptions,
  type AwsCatalogSearchResult
} from '../../shared/aws-catalog'

