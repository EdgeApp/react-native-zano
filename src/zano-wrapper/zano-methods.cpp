#import <stdio.h>
#import <plain_wallet_api.h>

#include "zano-methods.hpp"


std::string hello(const std::vector<std::string> &args) {
  printf("Zano says hello\n");
  return "hello";
}

std::string init(const std::vector<std::string> &args) {
  return plain_wallet::init(
    args[0], // address
    args[1], // cwd
    std::stoi(args[2]) // log level
  );
}

std::string initWithIpPort(const std::vector<std::string> &args) {
  return plain_wallet::init(
    args[0], // ip
    args[1], // port
    args[2], // cwd
    std::stoi(args[3]) // log level
  );
}

std::string reset(const std::vector<std::string> &args) {
  return plain_wallet::reset();
}

std::string setLogLevel(const std::vector<std::string> &args) {
  return plain_wallet::set_log_level(std::stoi(args[0]));
}

std::string getVersion(const std::vector<std::string> &args) {
  return plain_wallet::get_version();
}

std::string getWalletFiles(const std::vector<std::string> &args) {
  return plain_wallet::get_wallet_files();
}

std::string getExportPrivateInfo(const std::vector<std::string> &args) {
  return plain_wallet::get_export_private_info(args[0]);
}

std::string deleteWallet(const std::vector<std::string> &args) {
  return plain_wallet::delete_wallet(args[0]);
}

std::string getAddressInfo(const std::vector<std::string> &args) {
  return plain_wallet::get_address_info(args[0]);
}

std::string getAppconfig(const std::vector<std::string> &args) {
  return plain_wallet::get_appconfig(args[0]);
}

std::string setAppconfig(const std::vector<std::string> &args) {
  return plain_wallet::set_appconfig(args[0], args[1]);
}

std::string generateRandomKey(const std::vector<std::string> &args) {
  return plain_wallet::generate_random_key(std::stoull(args[0]));
}

std::string getLogsBuffer(const std::vector<std::string> &args) {
  return plain_wallet::get_logs_buffer();
}

std::string truncateLog(const std::vector<std::string> &args) {
  return plain_wallet::truncate_log();
}

std::string getConnectivityStatus(const std::vector<std::string> &args) {
  return plain_wallet::get_connectivity_status();
}

std::string open(const std::vector<std::string> &args) {
  return plain_wallet::open(args[0], args[1]);
}

std::string restore(const std::vector<std::string> &args) {
  return plain_wallet::restore(args[0], args[1], args[2], args[3]);
}

std::string generate(const std::vector<std::string> &args) {
  return plain_wallet::generate(args[0], args[1]);
}

std::string getOpenedWallets(const std::vector<std::string> &args) {
  return plain_wallet::get_opened_wallets();
}

std::string getWalletStatus(const std::vector<std::string> &args) {
  return plain_wallet::get_wallet_status(std::stoll(args[0]));
}

std::string closeWallet(const std::vector<std::string> &args) {
  return plain_wallet::close_wallet(std::stoll(args[0]));
}

std::string invoke(const std::vector<std::string> &args) {
  return plain_wallet::invoke(std::stoll(args[0]), args[1]);
}

std::string asyncCall(const std::vector<std::string> &args) {
  return plain_wallet::async_call(args[0], std::stoull(args[1]), args[2]);
}

std::string tryPullResult(const std::vector<std::string> &args) {
  return plain_wallet::try_pull_result(std::stoull(args[0]));
}

std::string syncCall(const std::vector<std::string> &args) {
  return plain_wallet::sync_call(args[0], std::stoull(args[1]), args[2]);
}

std::string isWalletExist(const std::vector<std::string> &args) {
  bool exists = plain_wallet::is_wallet_exist(args[0]);
  return std::to_string(exists);
}

std::string getWalletInfo(const std::vector<std::string> &args) {
  return plain_wallet::get_wallet_info(std::stoll(args[0]));
}

std::string resetWalletPassword(const std::vector<std::string> &args) {
  return plain_wallet::reset_wallet_password(std::stoll(args[0]), args[1]);
}

std::string getCurrentTxFee(const std::vector<std::string> &args) {
  uint64_t fee = plain_wallet::get_current_tx_fee(std::stoull(args[0]));
  return std::to_string(fee);
}

const ZanoMethod zanoMethods[] = {
  { "getVersion", 0, getVersion },
  { "hello", 0, hello },
  { "init", 3, init },
  { "initWithIpPort", 4, initWithIpPort },
  { "reset", 0, reset },
  { "setLogLevel", 1, setLogLevel },
  { "getWalletFiles", 0, getWalletFiles },
  { "getExportPrivateInfo", 1, getExportPrivateInfo },
  { "deleteWallet", 1, deleteWallet },
  { "getAddressInfo", 1, getAddressInfo },
  { "getAppconfig", 1, getAppconfig },
  { "setAppconfig", 2, setAppconfig },
  { "generateRandomKey", 1, generateRandomKey },
  { "getLogsBuffer", 0, getLogsBuffer },
  { "truncateLog", 0, truncateLog },
  { "getConnectivityStatus", 0, getConnectivityStatus },
  { "open", 2, open },
  { "restore", 4, restore },
  { "generate", 2, generate },
  { "getOpenedWallets", 0, getOpenedWallets },
  { "getWalletStatus", 1, getWalletStatus },
  { "closeWallet", 1, closeWallet },
  { "invoke", 2, invoke },
  { "asyncCall", 3, asyncCall },
  { "tryPullResult", 1, tryPullResult },
  { "syncCall", 3, syncCall },
  { "isWalletExist", 1, isWalletExist },
  { "getWalletInfo", 1, getWalletInfo },
  { "resetWalletPassword", 2, resetWalletPassword },
  { "getCurrentTxFee", 1, getCurrentTxFee }
};

const unsigned zanoMethodCount = std::end(zanoMethods) - std::begin(zanoMethods);
