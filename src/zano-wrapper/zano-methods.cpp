#import <stdio.h>
#import <plain_wallet_api.h>

#include "zano-methods.hpp"

std::string getVersion(const std::vector<const std::string> &args) {
  return plain_wallet::get_version();
}

std::string hello(const std::vector<const std::string> &args) {
  printf("Zano says hello\n");
  return "hello";
}

std::string initWallet(const std::vector<const std::string> &args) {
  return plain_wallet::init(
    args[0], // address
    args[1], // cwd
    std::stoi(args[2]) // log level
  );
}

const ZanoMethod zanoMethods[] = {
  { "getVersion", 0, getVersion },
  { "hello", 0, hello },
  { "initWallet", 3, initWallet }
};

const unsigned zanoMethodCount = std::end(zanoMethods) - std::begin(zanoMethods);
