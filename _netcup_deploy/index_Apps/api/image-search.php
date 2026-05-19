<?php
declare(strict_types=1);

const IMAGE_SEARCH_DEFAULT_MAX_PER_PAGE = 3;
const IMAGE_SEARCH_EXTENDED_MAX_PER_PAGE = 10;
const IMAGE_SEARCH_MAX_QUERY_LENGTH = 100;
const IMAGE_SEARCH_CACHE_TTL = 21600;

$allowedOrigins = [
    'https://edubiosim.de',
    'https://www.edubiosim.de',
    'https://school-grammar-games.github.io',
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    jsonError('Method not allowed.', 405);
}

$provider = strtolower(trim((string)($_GET['provider'] ?? '')));
$query = normalizeQuery((string)($_GET['q'] ?? ''));
$page = max(1, min(50, (int)($_GET['page'] ?? 1)));
$perPageLimit = imageSearchMaxPerPage((string)($_GET['app'] ?? ''), (string)($_SERVER['HTTP_REFERER'] ?? ''));
$perPage = max(1, min($perPageLimit, (int)($_GET['per_page'] ?? $perPageLimit)));
$allowedProviders = ['unsplash', 'pexels', 'pixabay'];

if (!in_array($provider, $allowedProviders, true)) {
    jsonError('Unknown image provider.', 400);
}

if ($query === '') {
    jsonError('Missing search query.', 400);
}

$keys = loadImageApiKeys();
$key = providerKey($keys, $provider);
if ($key === '') {
    jsonError('Image provider is not configured.', 500);
}

$cacheKey = hash('sha256', implode('|', [$provider, $query, (string)$page, (string)$perPage]));
$cached = readCache($cacheKey);
if ($cached !== null) {
    echo $cached;
    exit;
}

try {
    [$url, $headers] = buildProviderRequest($provider, $query, $page, $perPage, $key);
    [$status, $body] = httpGet($url, $headers);
    if ($status < 200 || $status >= 300) {
        jsonError(providerLabel($provider) . ' request failed.', 502);
    }
    $remote = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    $payload = json_encode([
        'provider' => $provider,
        'results' => normalizeProviderResults($provider, $remote, $query),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($payload === false) {
        jsonError('Could not encode image results.', 500);
    }
    writeCache($cacheKey, $payload);
    echo $payload;
} catch (Throwable $error) {
    jsonError('Image search failed.', 502);
}

function normalizeQuery(string $query): string
{
    $query = preg_replace('/\s+/u', ' ', trim($query)) ?? '';
    if (function_exists('mb_strlen') && function_exists('mb_substr')) {
        return mb_strlen($query, 'UTF-8') > IMAGE_SEARCH_MAX_QUERY_LENGTH
            ? mb_substr($query, 0, IMAGE_SEARCH_MAX_QUERY_LENGTH, 'UTF-8')
            : $query;
    }
    return strlen($query) > IMAGE_SEARCH_MAX_QUERY_LENGTH
        ? substr($query, 0, IMAGE_SEARCH_MAX_QUERY_LENGTH)
        : $query;
}

function imageSearchMaxPerPage(string $app, string $referer): int
{
    $app = strtolower(trim($app));
    $path = parse_url($referer, PHP_URL_PATH);
    $refererPath = is_string($path) ? $path : '';
    $allowedApps = [
        'social_media_generator' => '/index_Apps/Apps/Social_Media_Generator/',
        'comic_studio' => '/index_Apps/Apps/Comic_App/',
    ];

    if (isset($allowedApps[$app]) && strpos($refererPath, $allowedApps[$app]) === 0) {
        return IMAGE_SEARCH_EXTENDED_MAX_PER_PAGE;
    }

    return IMAGE_SEARCH_DEFAULT_MAX_PER_PAGE;
}
function loadImageApiKeys(): array
{
    $keys = [
        'unsplash' => getenv('UNSPLASH_ACCESS_KEY') ?: '',
        'pexels' => getenv('PEXELS_API_KEY') ?: '',
        'pixabay' => getenv('PIXABAY_API_KEY') ?: '',
    ];

    $projectRoot = dirname(__DIR__);
    $candidates = [
        $projectRoot . '/../../private/image-api-keys.php',
        $projectRoot . '/../private/image-api-keys.php',
        $projectRoot . '/private/image-api-keys.php',
    ];

    foreach ($candidates as $path) {
        if (!is_file($path)) {
            continue;
        }
        $fileKeys = require $path;
        if (is_array($fileKeys)) {
            $keys = array_merge($keys, flattenKeyConfig($fileKeys));
        }
        break;
    }

    return $keys;
}

function flattenKeyConfig(array $config): array
{
    return [
        'unsplash' => (string)($config['unsplash']['accessKey'] ?? $config['unsplash'] ?? ''),
        'pexels' => (string)($config['pexels']['apiKey'] ?? $config['pexels'] ?? ''),
        'pixabay' => (string)($config['pixabay']['apiKey'] ?? $config['pixabay'] ?? ''),
    ];
}

function providerKey(array $keys, string $provider): string
{
    return trim((string)($keys[$provider] ?? ''));
}

function buildProviderRequest(string $provider, string $query, int $page, int $perPage, string $key): array
{
    if ($provider === 'unsplash') {
        $url = 'https://api.unsplash.com/search/photos?query=' . rawurlencode($query) . '&page=' . $page . '&per_page=' . $perPage . '&orientation=landscape&content_filter=high';
        return [$url, ['Authorization: Client-ID ' . $key, 'Accept-Version: v1']];
    }

    if ($provider === 'pexels') {
        $url = 'https://api.pexels.com/v1/search?query=' . rawurlencode($query) . '&page=' . $page . '&per_page=' . $perPage;
        return [$url, ['Authorization: ' . $key]];
    }

    $url = 'https://pixabay.com/api/?key=' . rawurlencode($key) . '&q=' . rawurlencode($query) . '&page=' . $page . '&per_page=' . $perPage . '&image_type=photo&safesearch=true';
    return [$url, []];
}

function httpGet(string $url, array $headers): array
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'CityGuideImageProxy/1.0',
        ]);
        $body = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return [$status, is_string($body) ? $body : ''];
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => implode("\r\n", array_merge($headers, ['User-Agent: CityGuideImageProxy/1.0'])),
            'ignore_errors' => true,
            'timeout' => 12,
        ],
    ]);
    $body = file_get_contents($url, false, $context);
    $status = 0;
    foreach (($http_response_header ?? []) as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $matches)) {
            $status = (int)$matches[1];
            break;
        }
    }
    return [$status, is_string($body) ? $body : ''];
}

function normalizeProviderResults(string $provider, array $data, string $query): array
{
    if ($provider === 'unsplash') {
        return array_values(array_filter(array_map(static function (array $item) use ($query): array {
            $name = (string)($item['user']['name'] ?? 'Unknown photographer');
            $thumb = (string)($item['urls']['small'] ?? $item['urls']['thumb'] ?? $item['urls']['regular'] ?? '');
            $full = (string)($item['urls']['regular'] ?? $item['urls']['full'] ?? $item['urls']['small'] ?? $thumb);
            return normalizedImage(
                (string)($item['id'] ?? ''),
                $thumb,
                $full,
                (string)($item['alt_description'] ?? $item['description'] ?? $query),
                'Photo by ' . $name . ' on Unsplash',
                (string)($item['links']['html'] ?? ''),
                $name,
                (string)($item['user']['links']['html'] ?? ''),
                'Unsplash License'
            );
        }, $data['results'] ?? [])));
    }

    if ($provider === 'pexels') {
        return array_values(array_filter(array_map(static function (array $item) use ($query): array {
            $name = (string)($item['photographer'] ?? 'Unknown photographer');
            return normalizedImage(
                (string)($item['id'] ?? ''),
                (string)($item['src']['medium'] ?? $item['src']['small'] ?? ''),
                (string)($item['src']['large2x'] ?? $item['src']['large'] ?? $item['src']['original'] ?? ''),
                (string)($item['alt'] ?? $query),
                'Photo by ' . $name . ' on Pexels',
                (string)($item['url'] ?? ''),
                $name,
                (string)($item['photographer_url'] ?? ''),
                'Pexels License'
            );
        }, $data['photos'] ?? [])));
    }

    return array_values(array_filter(array_map(static function (array $item) use ($query): array {
        $name = (string)($item['user'] ?? 'Unknown creator');
        return normalizedImage(
            (string)($item['id'] ?? ''),
            (string)($item['webformatURL'] ?? $item['previewURL'] ?? ''),
            (string)($item['largeImageURL'] ?? $item['webformatURL'] ?? ''),
            (string)($item['tags'] ?? $query),
            'Image by ' . $name . ' on Pixabay',
            (string)($item['pageURL'] ?? ''),
            $name,
            isset($item['user'], $item['user_id']) ? 'https://pixabay.com/users/' . rawurlencode((string)$item['user']) . '-' . rawurlencode((string)$item['user_id']) . '/' : '',
            'Pixabay License'
        );
    }, $data['hits'] ?? [])));
}

function normalizedImage(string $id, string $thumb, string $full, string $alt, string $credit, string $pageUrl, string $authorName, string $authorUrl, string $licenseText): array
{
    if ($thumb === '' && $full === '') {
        return [];
    }
    return [
        'id' => $id,
        'thumb' => $thumb !== '' ? $thumb : $full,
        'full' => $full !== '' ? $full : $thumb,
        'alt' => $alt,
        'credit' => $credit,
        'pageUrl' => $pageUrl,
        'authorName' => $authorName,
        'authorUrl' => $authorUrl,
        'licenseText' => $licenseText,
    ];
}

function providerLabel(string $provider): string
{
    return ['unsplash' => 'Unsplash', 'pexels' => 'Pexels', 'pixabay' => 'Pixabay'][$provider] ?? 'Image provider';
}

function cachePath(string $cacheKey): string
{
    return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'city-guide-image-cache' . DIRECTORY_SEPARATOR . $cacheKey . '.json';
}

function readCache(string $cacheKey): ?string
{
    $path = cachePath($cacheKey);
    if (!is_file($path) || filemtime($path) + IMAGE_SEARCH_CACHE_TTL < time()) {
        return null;
    }
    $content = file_get_contents($path);
    return is_string($content) ? $content : null;
}

function writeCache(string $cacheKey, string $payload): void
{
    $dir = dirname(cachePath($cacheKey));
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        return;
    }
    @file_put_contents(cachePath($cacheKey), $payload, LOCK_EX);
}

function jsonError(string $message, int $status): void
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}