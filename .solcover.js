module.exports = {
    skipFiles: [
        'assetManager/library/mock/',
        'assetManager/mock/',
        'diamond/mock/',
        'fassetToken/mock/',
        'fdc/mock/',
        'governance/mock/',
        'openzeppelin/mock/',
        'utils/mock/'
    ],
    istanbulReporter: ['html', 'json', 'text-summary', 'lcov']
};
