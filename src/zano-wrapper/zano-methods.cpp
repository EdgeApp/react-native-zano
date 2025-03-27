#import <stdio.h>

#include "zano-methods.hpp"

std::string hello(const std::vector<const std::string> &args) {
  printf("Zano says hello\n");
  return "hello";
}

const ZanoMethod zanoMethods[] = {
  { "hello", 0, hello }
};

const unsigned zanoMethodCount = std::end(zanoMethods) - std::begin(zanoMethods);
